# ATTENZIONE PicPocket!!!

Viewing [IRL](https://dictionary.cambridge.org/dictionary/english/irl) presentations shouldn't be a hassle.  

From venues with tiny screens to sitting too far back at church, PicPocket makes things clearer *(for good)*.

<div align="center">
  <img src="./asset/see.jpeg" width="30%">
</div>

## Usage

Access PicPocket live at [picpocket.onrender.com](https://picpocket.onrender.com/).

## Architecture 

```mermaid
sequenceDiagram
    actor Presenter as Presenter
    participant Server
    actor Audience as Audience

    Presenter->>Server: GET /presenter
    Server->>Presenter: Redirect to /presenter.html?id=:sessionId
    Presenter->>Server: WS /ws/presenter?id=:sessionId
    Server-->>Presenter: WebSocket connection established

    Audience->>Server: GET /join/:sessionId
    Server->>Audience: Serve audience.html
    Audience->>Server: WS /ws/audience?id=:sessionId
    Server-->>Audience: WebSocket connection established

    loop Screen Sharing
        Presenter->>Server: Send screen frame (data:image/...)
        Server->>Audience: Broadcast frame to all audience WS
        Audience->>Server: POST /api/save-image (with imageData)
        Server->>Audience: Return compressed PNG
    end

    Presenter->>Server: Stop sharing (WS close)
    Server->>Audience: Send disconnected message
    Server->>Audience: Close all audience WS connections
```

## Nerd details

...

## Contributors

<table>
	<tbody>
        <tr>
            <td align="center">
                <a href="https://www.linkedin.com/in/gabriel-zmong/">
                    <img src="https://avatars.githubusercontent.com/u/117062305?v=4" width="100;" alt="gongahkia"/>
                    <br />
                    <sub><b>Gabriel Ong</b></sub>
                </a>
                <br />
            </td>
            <td align="center">
                <a href="https://www.linkedin.com/in/samuelrawrs/">
                    <img src="https://avatars.githubusercontent.com/u/54682777?v=4" width="100;" alt="samuelrawrs"/>
                    <br />
                    <sub><b>Samuel Ang</b></sub>
                </a>
                <br />
            </td>
        </tr>
	</tbody>
</table>
